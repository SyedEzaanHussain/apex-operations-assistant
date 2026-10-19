import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DocumentsPanel from "../components/DocumentsPanel";

const doc = (o) => ({ id: 1, filename: "a.txt", sizeBytes: 10, status: "READY", createdAt: new Date().toISOString(), attempts: 1, ...o });

describe("Documents", () => {
  it("empty state", async () => {
    render(<DocumentsPanel api={{ listDocuments: vi.fn().mockResolvedValue([]) }} pollMs={50} />);
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });
  it("FAILED document shows the reason and a working retry", async () => {
    const api = {
      listDocuments: vi.fn().mockResolvedValue([doc({ status: "FAILED", failureCode: "BINARY_CONTENT", failureMessage: "File contains binary data" })]),
      retryDocument: vi.fn().mockResolvedValue(doc({ status: "PROCESSING" })),
    };
    render(<DocumentsPanel api={api} pollMs={50} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/binary data.*BINARY_CONTENT/i);
    await userEvent.click(screen.getByRole("button", { name: /retry processing/i }));
    expect(api.retryDocument).toHaveBeenCalledWith(1);
  });
  it("surfaces an upload error with its trace id", async () => {
    const e = Object.assign(new Error("Allowed file types: txt, md, csv, json"), { code: "UNSUPPORTED_MEDIA_TYPE", traceId: "trace-up-1" });
    const api = { listDocuments: vi.fn().mockResolvedValue([]), uploadDocument: vi.fn().mockRejectedValue(e) };
    render(<DocumentsPanel api={api} pollMs={50} />);
    await screen.findByText(/no documents yet/i);
    await userEvent.upload(screen.getByLabelText(/upload a document/i), new File(["x"], "evil.exe"), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("trace-up-1");
  });
  it("polls while a document is processing", async () => {
    const list = vi.fn().mockResolvedValueOnce([doc({ status: "PROCESSING" })]).mockResolvedValue([doc({ status: "READY" })]);
    render(<DocumentsPanel api={{ listDocuments: list }} pollMs={30} />);
    expect(await screen.findByText("READY", {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
