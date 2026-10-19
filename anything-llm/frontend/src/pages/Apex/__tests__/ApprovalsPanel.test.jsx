import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ApprovalsPanel from "../components/ApprovalsPanel";

const action = (over = {}) => ({
  id: 7, actionType: "CREATE_WORK_ORDER", source: "AI", status: "PENDING_REVIEW",
  payload: { title: "Repair pump", description: "d", priority: "MEDIUM" }, externalRef: null, lastError: null,
  qaRequest: { question: "When to repair?", answer: "Weekly window.", citations: [{ ordinal: 0, filename: "sop.txt" }] }, ...over,
});
const history = [{ id: 1, eventType: "ACTION_PROPOSED", actorRole: "user", traceId: "abcdef123456", createdAt: new Date().toISOString() }];
const makeApi = (over = {}) => ({
  listActions: vi.fn().mockResolvedValue([action()]),
  getAction: vi.fn().mockResolvedValue(action()),
  actionHistory: vi.fn().mockResolvedValue(history),
  approve: vi.fn().mockResolvedValue(action({ status: "EXECUTED" })),
  reject: vi.fn(), retryAction: vi.fn(), ...over,
});
const open = async (api, role) => {
  render(<ApprovalsPanel api={api} role={role} />);
  await userEvent.click(await screen.findByRole("button", { name: /#7 repair pump/i }));
  await screen.findByRole("article", { name: /action 7 details/i });
};

describe("Approval flow", () => {
  it("NEGATIVE: a normal user sees no approve/reject controls", async () => {
    await open(makeApi(), "user");
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only reviewers can approve/i)).toBeInTheDocument();
  });

  it("NEGATIVE: if the server denies (403) the UI shows the denial and the status does not change", async () => {
    const forbidden = Object.assign(new Error("You are not allowed to perform this action"), { code: "FORBIDDEN", traceId: "trace-403" });
    const api = makeApi({ approve: vi.fn().mockRejectedValue(forbidden) });
    await open(api, "reviewer"); // e.g. stale UI role / tampered client
    await userEvent.click(screen.getByRole("button", { name: /approve & submit/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not allowed/i);
    expect(alert).toHaveTextContent("FORBIDDEN");
    expect(alert).toHaveTextContent("trace-403");
    expect(screen.getAllByText("PENDING REVIEW").length).toBeGreaterThan(0); // unchanged
  });

  it("reviewer approves: one API call (button locks while in flight), then EXECUTED is shown", async () => {
    let finish;
    const approve = vi.fn(() => new Promise((r) => { finish = r; }));
    const api = makeApi({ approve });
    await open(api, "reviewer");
    const btn = screen.getByRole("button", { name: /approve & submit/i });
    await userEvent.click(btn);
    await userEvent.click(btn); // rapid second click
    expect(approve).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    api.getAction.mockResolvedValue(action({ status: "EXECUTED", externalRef: "WO-1234" }));
    api.listActions.mockResolvedValue([action({ status: "EXECUTED" })]);
    finish(action({ status: "EXECUTED" }));
    await waitFor(() => expect(screen.getByText("WO-1234")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /approve & submit/i })).not.toBeInTheDocument();
  });

  it("UNKNOWN outcome explains that retry is safe and retries on click", async () => {
    const api = makeApi({
      listActions: vi.fn().mockResolvedValue([action({ status: "UNKNOWN" })]),
      getAction: vi.fn().mockResolvedValue(action({ status: "UNKNOWN", lastError: "EXTERNAL_TIMEOUT" })),
      retryAction: vi.fn().mockResolvedValue(action({ status: "EXECUTED" })),
    });
    await open(api, "reviewer");
    expect(screen.getByRole("status")).toHaveTextContent(/cannot create a duplicate/i);
    await userEvent.click(screen.getByRole("button", { name: /retry submission/i }));
    expect(api.retryAction).toHaveBeenCalledWith(7);
  });

  it("shows the empty state when there are no actions", async () => {
    render(<ApprovalsPanel api={makeApi({ listActions: vi.fn().mockResolvedValue([]) })} role="user" />);
    expect(await screen.findByText(/no proposed actions yet/i)).toBeInTheDocument();
  });
});
