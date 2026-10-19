import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AskPanel from "../components/AskPanel";

const grounded = {
  id: 1, question: "q", status: "ANSWERED", grounded: true, traceId: "trace-abc-123", latencyMs: 12, provider: "mock",
  answer: "Apply lockout tagout before pump repair.",
  citations: [{ chunkId: 1, ordinal: 0, filename: "sop.txt", snippet: "Isolate power and apply lockout tagout." }],
  proposedAction: { id: 9, actionType: "CREATE_WORK_ORDER", status: "PENDING_REVIEW" },
};
const err = (code, message, traceId = "trace-err-1") => Object.assign(new Error(message), { code, traceId });
const ask = async (api, text = "What before pump repair?") => {
  const onProposed = vi.fn();
  render(<AskPanel api={api} onActionProposed={onProposed} />);
  await userEvent.type(screen.getByLabelText(/question about your uploaded documents/i), text);
  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  return onProposed;
};

describe("Ask flow", () => {
  it("shows loading, then the answer with citations, trace id and the proposed-action notice", async () => {
    let resolve;
    const api = { ask: vi.fn(() => new Promise((r) => { resolve = r; })) };
    const onProposed = await ask(api);
    expect(screen.getByRole("status")).toHaveTextContent(/searching documents/i); // loading state
    expect(screen.getByRole("button", { name: /asking/i })).toBeDisabled(); // no double submit
    resolve(grounded);
    expect(await screen.findByText(/lockout tagout before pump repair/i)).toBeInTheDocument();
    expect(screen.getByText("sop.txt")).toBeInTheDocument(); // citation
    expect(screen.getByText("trace-abc-123")).toBeInTheDocument(); // trace id
    expect(screen.getByText(/sent for reviewer approval/i)).toBeInTheDocument();
    expect(onProposed).toHaveBeenCalledWith(grounded.proposedAction);
    expect(api.ask).toHaveBeenCalledTimes(1);
  });

  it("answer with NO citations is flagged as unverified and shows no sources list", async () => {
    const api = { ask: vi.fn().mockResolvedValue({ ...grounded, grounded: false, citations: [], proposedAction: null }) };
    await ask(api);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no sources were cited/i);
    expect(screen.queryByText(/^Sources/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sent for reviewer approval/i)).not.toBeInTheDocument();
  });

  it("empty state when no documents are READY", async () => {
    const api = { ask: vi.fn().mockRejectedValue(err("NO_READY_DOCUMENTS", "No processed documents")) };
    await ask(api);
    expect(await screen.findByText(/nothing to search yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error state shows the message + trace id, and Try again re-submits", async () => {
    const api = { ask: vi.fn().mockRejectedValueOnce(err("AI_UNAVAILABLE", "The AI service is unavailable.")).mockResolvedValueOnce(grounded) };
    await ask(api);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The AI service is unavailable.");
    expect(alert).toHaveTextContent("trace-err-1");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText(/lockout tagout before pump repair/i)).toBeInTheDocument());
    expect(api.ask).toHaveBeenCalledTimes(2);
  });

  it("renders model output as text, never as HTML", async () => {
    const api = { ask: vi.fn().mockResolvedValue({ ...grounded, answer: '<img src=x onerror="window.__pwned=1">hello', proposedAction: null }) };
    const { container } = (await ask(api), { container: document.body });
    await screen.findByText(/hello/);
    expect(container.querySelector("img")).toBeNull();
  });
});
