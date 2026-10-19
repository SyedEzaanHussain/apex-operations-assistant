const express = require("express");
const dto = require("./dto");
const { validate, schemas } = require("../http/validate");
const { wrap } = require("./documents.routes");

function qaRoutes({ qaService }) {
  const r = express.Router();
  r.post("/qa/ask", validate(schemas.ask), wrap(async (req, res) => {
    const result = await qaService.ask({ user: req.user, question: req.body.question, traceId: req.traceId });
    res.json({ qa: dto.qa(result), traceId: req.traceId });
  }));
  r.get("/qa", wrap(async (req, res) => {
    res.json({ items: (await qaService.list(req.user)).map(dto.qa), traceId: req.traceId });
  }));
  r.get("/qa/:id", validate(schemas.idParam, "params"), wrap(async (req, res) => {
    res.json({ qa: dto.qa(await qaService.get(req.user, Number(req.params.id))), traceId: req.traceId });
  }));
  return r;
}
module.exports = { qaRoutes };
