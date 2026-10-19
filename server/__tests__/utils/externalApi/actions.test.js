/* eslint-env jest, node */

const mockAction = {
  id: 41,
  workspaceId: 5,
  chatId: 2,
  payload: JSON.stringify({ operation: "create-record" }),
};
let mockCurrentAction;
const mockAuditCreate = jest.fn();
const originalFetch = global.fetch;

jest.mock("../../../utils/prisma", () => ({
  $transaction: jest.fn(),
  proposed_actions: {
    updateMany: jest.fn(async ({ where, data }) => {
      if (
        !mockCurrentAction ||
        mockCurrentAction.id !== where.id ||
        !(Array.isArray(where.status?.in)
          ? where.status.in.includes(mockCurrentAction.status)
          : where.status === mockCurrentAction.status)
      ) {
        return { count: 0 };
      }
      mockCurrentAction = {
        ...mockCurrentAction,
        ...data,
        attempts:
          data.attempts?.increment !== undefined
            ? mockCurrentAction.attempts + data.attempts.increment
            : mockCurrentAction.attempts,
      };
      return { count: 1 };
    }),
    findUnique: jest.fn(async () => mockCurrentAction),
  },
  audit_events: {
    create: (...args) => mockAuditCreate(...args),
  },
}));

const prisma = require("../../../utils/prisma");
const { executeAction } = require("../../../utils/externalApi");

describe("idempotent action execution", () => {
  beforeEach(() => {
    mockCurrentAction = {
      ...mockAction,
      status: "approved",
      attempts: 0,
    };
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma)
    );
    prisma.proposed_actions.updateMany.mockClear();
    prisma.proposed_actions.findUnique.mockClear();
    mockAuditCreate.mockClear();
    process.env.EXTERNAL_API_URL = "http://mock-enterprise.test/actions";
    global.fetch = jest.fn();
  });

  afterAll(() => {
    delete process.env.EXTERNAL_API_URL;
    global.fetch = originalFetch;
  });

  test("concurrent approvals can claim and execute an action only once", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "external-41" }),
    });

    const results = await Promise.all([
      executeAction(mockCurrentAction, 99, "trace-one"),
      executeAction(mockCurrentAction, 100, "trace-two"),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("41");
    expect(mockCurrentAction.status).toBe("executed");
    expect(mockCurrentAction.externalRef).toBe("external-41");
  });

  test("an unknown outcome retries with the same idempotency key", async () => {
    global.fetch
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "external-41" }),
      });

    const first = await executeAction(mockCurrentAction, 99, "trace-one");
    expect(first.action.status).toBe("unknown");
    const retry = await executeAction(first.action, 99, "trace-two");

    expect(retry.action.status).toBe("executed");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("41");
    expect(global.fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe("41");
  });

});
