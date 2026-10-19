const Joi = require("joi");
const { E } = require("./errors");

const validate = (schema, source = "body") => (req, _res, next) => {
  const { value, error } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
  if (error)
    return next(
      E.badRequest(
        "Request validation failed",
        error.details.map((d) => ({ path: d.path.join("."), message: d.message }))
      )
    );
  req[source] = value;
  next();
};

const ACTION_TYPES = ["CREATE_WORK_ORDER", "ESCALATE_INCIDENT"];
const actionPayload = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().max(2000).allow("").default(""),
  priority: Joi.string().valid("LOW", "MEDIUM", "HIGH").default("MEDIUM"),
}).required();

const schemas = {
  actionPayload,
  ask: Joi.object({ question: Joi.string().trim().min(3).max(2000).required() }),
  createAction: Joi.object({
    qaRequestId: Joi.number().integer().positive().required(),
    actionType: Joi.string().valid(...ACTION_TYPES).required(),
    payload: actionPayload,
  }),
  review: Joi.object({ note: Joi.string().trim().max(500).allow("").default("") }),
  idParam: Joi.object({ id: Joi.number().integer().positive().required() }),
};

module.exports = { validate, schemas, ACTION_TYPES };
