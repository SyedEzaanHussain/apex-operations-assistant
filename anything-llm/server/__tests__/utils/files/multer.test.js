/* eslint-env jest, node */

const mockMulter = jest.fn((options) => ({
  single: () => (request, _response, callback) => {
    options.fileFilter(request, { originalname: request.uploadName }, (error) =>
      callback(error)
    );
  },
}));
mockMulter.diskStorage = jest.fn(() => ({}));

jest.mock("multer", () => mockMulter);
jest.mock("../../../utils/files", () => ({
  normalizePath: (value) => value,
  sanitizeFileName: (value) => value,
}));
jest.mock("../../../collector/utils/constants", () => ({
  SUPPORTED_FILETYPE_CONVERTERS: {
    ".pdf": "pdf",
    ".txt": "text",
  },
}));

const { handleFileUpload } = require("../../../utils/files/multer");

describe("document upload validation", () => {
  test("rejects unsupported document extensions", () => {
    const request = { uploadName: "payload.exe" };
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    handleFileUpload(request, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: "Invalid file upload. Unsupported document file type: .exe.",
    });
  });

  test("retains the existing 3 GB upload ceiling", () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    handleFileUpload({ uploadName: "document.pdf" }, response, jest.fn());
    const options = mockMulter.mock.calls[0][0];
    expect(options.limits.fileSize).toBe(3 * 1024 * 1024 * 1024);
  });
});
