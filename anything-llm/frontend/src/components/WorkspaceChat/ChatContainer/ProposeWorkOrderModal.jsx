import { useState } from "react";
import { v4 } from "uuid";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalInput,
  ModalPrimaryButton,
  ModalSecondaryButton,
  ModalTextarea,
} from "@/components/lib/Modal";
import ProposedAction from "@/models/proposedAction";
import showToast from "@/utils/toast";

export default function ProposeWorkOrderModal({
  isOpen,
  closeModal,
  workspace,
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitProposal(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { action } = await ProposedAction.propose({
        workspaceId: workspace.id,
        payload: { title: title.trim(), description: description.trim() },
        idempotencyKey: v4(),
      });
      showToast(`Work order proposal #${action.id} sent for review.`, "success");
      setTitle("");
      setDescription("");
      closeModal();
    } catch (error) {
      showToast(`Unable to submit work order proposal: ${error.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={submitting ? undefined : closeModal} size="md">
      <form onSubmit={submitProposal} className="flex flex-col gap-y-5">
        <ModalHeader
          title="Propose a work order"
          subtitle="A workspace manager or admin must approve it before it is sent."
          onClose={submitting ? undefined : closeModal}
        />
        <ModalBody>
          <ModalInput
            label="Title"
            name="work-order-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Describe the work"
            maxLength={200}
            required
            disabled={submitting}
          />
          <ModalTextarea
            label="Description"
            name="work-order-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add details for the reviewer and work-order system"
            maxLength={4000}
            rows={4}
            required
            disabled={submitting}
          />
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton
            type="button"
            onClick={closeModal}
            disabled={submitting}
          >
            Cancel
          </ModalSecondaryButton>
          <ModalPrimaryButton type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit for review"}
          </ModalPrimaryButton>
        </ModalFooter>
      </form>
    </Modal>
  );
}
