const express = require("express");
const multer = require("multer");
const dto = require("./dto");
const { validate, schemas } = require("../http/validate");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function documentsRoutes({ documentService, config }) {
  const r = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

  r.post("/documents", upload.single("file"), wrap(async (req, res) => {
    const doc = await documentService.upload({ user: req.user, file: req.file, traceId: req.traceId });
    res.status(202).json({ document: dto.doc(doc), traceId: req.traceId }); // 202: accepted, processing is async
  }));
  r.get("/documents", wrap(async (req, res) => {
    res.json({ documents: (await documentService.list(req.user)).map(dto.doc), traceId: req.traceId });
  }));
  r.get("/documents/:id", validate(schemas.idParam, "params"), wrap(async (req, res) => {
    res.json({ document: dto.doc(await documentService.get(req.user, Number(req.params.id))), traceId: req.traceId });
  }));
  r.post("/documents/:id/retry", validate(schemas.idParam, "params"), wrap(async (req, res) => {
    const doc = await documentService.retry({ user: req.user, id: Number(req.params.id), traceId: req.traceId });
    res.status(202).json({ document: dto.doc(doc), traceId: req.traceId });
  }));
  return r;
}
module.exports = { documentsRoutes, wrap };
