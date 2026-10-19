/* eslint-env jest, node */

jest.mock("../../utils/prisma", () => ({}));
jest.mock("../../models/workspace", () => ({
  Workspace: { getWithUser: jest.fn() },
}));
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_request, _response, next) => next(),
}));

const prisma = require("../../utils/prisma");
const { Workspace } = require("../../models/workspace");
const { actionsEndpoints } = require("../../endpoints/actions");

describe("proposed action permissions", () => {
  beforeEach(() => {
    delete prisma.proposed_actions;
    delete prisma.$transaction;
    Workspace.getWithUser.mockReset();
  });

  test("an authenticated workspace member can create a proposed action", async () => {
    const routes = {};
    const app = {
      post: (path, middleware, handler) => {
        routes[`POST ${path}`] = { middleware, handler };
      },
      get: (path, middleware, handler) => {
        routes[`GET ${path}`] = { middleware, handler };
      },
    };
    actionsEndpoints(app);

    const proposedAction = {
      id: 19,
      workspaceId: 3,
      chatId: null,
      createdBy: 12,
      payload: JSON.stringify({ operation: "test" }),
      status: "proposed",
      idempotencyKey: "test-proposal-19",
    };
    const transaction = {
      proposed_actions: {
        create: jest.fn().mockResolvedValue(proposedAction),
      },
      audit_events: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.proposed_actions = {
      findUnique: jest.fn().mockResolvedValue(null),
    };
    prisma.$transaction = jest.fn((callback) => callback(transaction));
    Workspace.getWithUser = jest.fn().mockResolvedValue({ id: 3 });

    const route = routes["POST /actions"];
    const request = {
      body: { workspaceId: 3, payload: { operation: "test" } },
      header: jest.fn().mockReturnValue("test-proposal-19"),
      traceId: "trace-proposal-test",
    };
    const response = {
      locals: {
        multiUserMode: true,
        user: { id: 12, role: "default", suspended: 0 },
      },
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await route.middleware[0](request, response, next);
    await route.middleware[1](request, response, next);
    await route.handler(request, response);

    expect(Workspace.getWithUser).toHaveBeenCalledWith(
      response.locals.user,
      { id: 3 }
    );
    expect(transaction.proposed_actions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 3,
        createdBy: 12,
        payload: JSON.stringify({ operation: "test" }),
        idempotencyKey: "test-proposal-19",
      }),
    });
    expect(transaction.audit_events.create).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ action: proposedAction });
  });

  test("a default user cannot approve an action", async () => {
    const routes = {};
    const app = {
      post: (path, middleware, handler) => {
        routes[`POST ${path}`] = { middleware, handler };
      },
      get: (path, middleware, handler) => {
        routes[`GET ${path}`] = { middleware, handler };
      },
    };
    actionsEndpoints(app);

    const route = routes["POST /actions/:id/approve"];
    const request = {
      params: { id: "7" },
      body: {},
      traceId: "trace-default-role",
    };
    const response = {
      locals: {
        multiUserMode: true,
        user: { id: 12, role: "default", suspended: 0 },
      },
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    await route.middleware[0](request, response, jest.fn());
    await route.middleware[1](request, response, jest.fn());
    route.middleware[2](request, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: "Reviewer or administrator role required.",
    });
    expect(prisma.proposed_actions).toBeUndefined();
  });
});
