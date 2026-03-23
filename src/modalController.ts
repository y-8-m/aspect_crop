export type ModalController = {
  openPreview(previewUrl: string): void;
  closePreview(): void;
  isPreviewOpen(): boolean;
  openRatio(): void;
  closeRatio(): void;
  isRatioOpen(): boolean;
  handleEscape(): boolean;
};

type ModalControllerOptions = {
  previewModal: HTMLDivElement;
  previewImage: HTMLImageElement;
  closePreviewButton: HTMLButtonElement;
  ratioModal: HTMLDivElement;
  closeRatioButton: HTMLButtonElement;
  ratioInitialFocus: HTMLElement;
  prepareRatioModal: () => void;
  onCloseRatio: () => void;
};

export function createModalController(options: ModalControllerOptions): ModalController {
  const {
    previewModal,
    previewImage,
    closePreviewButton,
    ratioModal,
    closeRatioButton,
    ratioInitialFocus,
    prepareRatioModal,
    onCloseRatio
  } = options;

  const closePreview = (): void => {
    previewModal.classList.add("hidden");
  };

  const closeRatio = (): void => {
    ratioModal.classList.add("hidden");
    onCloseRatio();
  };

  closePreviewButton.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (event) => {
    if (event.target === previewModal) {
      closePreview();
    }
  });

  closeRatioButton.addEventListener("click", closeRatio);
  ratioModal.addEventListener("click", (event) => {
    if (event.target === ratioModal) {
      closeRatio();
    }
  });

  return {
    openPreview(previewUrl: string): void {
      previewImage.src = previewUrl;
      previewModal.classList.remove("hidden");
    },
    closePreview,
    isPreviewOpen(): boolean {
      return !previewModal.classList.contains("hidden");
    },
    openRatio(): void {
      prepareRatioModal();
      ratioModal.classList.remove("hidden");
      ratioInitialFocus.focus();
      if (ratioInitialFocus instanceof HTMLInputElement) {
        ratioInitialFocus.select();
      }
    },
    closeRatio,
    isRatioOpen(): boolean {
      return !ratioModal.classList.contains("hidden");
    },
    handleEscape(): boolean {
      if (!ratioModal.classList.contains("hidden")) {
        closeRatio();
        return true;
      }

      if (!previewModal.classList.contains("hidden")) {
        closePreview();
        return true;
      }

      return false;
    }
  };
}
