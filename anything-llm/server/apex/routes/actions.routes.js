const express = require("express");
const dto = require("./dto");
const { E } = require("../http/errors");
const { validate, schemas } = require("../http/validate");
const { wrap } = require("./documents.routes");

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

function actionsRoutes({ actionService, qaService, requireRole }) {
  const r = express.Router();
  const reviewer = requireRole("reviewer", "admin"); // authorization is enforced HERE, server-side

  r.post("/actions", validate(schemas.createAction), wrap(async (req, res) => {
    const requestKey = req.header("idempotency-key") || null;
    if (requestKey && !KEY.test(requestKey)) throw E.badRequest("Idempotency-Key must match [A-Za-z0-9_-]{8,64}");
    const qaRequest = await qaService.get(req.user, req.body.qaRequestId); // 404 if not visible to caller
    const { action, created } = await actionService.propose({
      user: req.user, qaRequest, source: "USER", actionType: req.body.actionType,
      payload: req.body.payload, requestKey, traceId: req.traceId,
    });
    res.status(created ? 201 : 200).json({ action: dto.action(action), replayed: !created, traceId: req.traceId });
  }));

  r.get("/actions", wrap(async (req, res) => {
    res.json({ actions: (await actionService.list(req.user)).map((a) => dto.action(a)), traceId: req.traceId });
  }));
  r.get("/actions/:id", validate(schemas.idParam, "params"), wrap(async (req, res) => {
    res.json({ action: dto.action(await actionService.get(req.user, Number(req.params.id))), traceId: req.traceId });
  }));
  r.get("/actions/:id/history", validate(schemas.idParam, "params"), wrap(async (req, res) => {
    res.json({ history: (await actionService.history(req.user, Number(req.params.id))).map(dto.audit), traceId: req.traceId });
  }));

  const review = (method) => [reviewer, validate(schemas.idParam, "params"), validate(schemas.review), wrap(async (req, res) => {
    const a = await actionService[method]({ user: req.user, id: Number(req.params.id), note: req.body.note, traceId: req.traceId });
    res.json({ action: dto.action(a), traceId: req.traceId });
  })];
  r.post("/actions/:id/approve", ...review("approve"));
  r.post("/actions/:id/reject", ...review("reject"));
  r.post("/actions/:id/retry", reviewer, validate(schemas.idParam, "params"), wrap(async (req, res) => {
    const a = await actionService.retry({ user: req.user, id: Number(req.params.id), traceId: req.traceId });
    res.json({ action: dto.action(a), traceId: req.traceId });
  }));
  return r;
}
module.exports = { actionsRoutes };
