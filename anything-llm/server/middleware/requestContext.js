const { v4: uuidv4 } = require("uuid");

function requestContext(request, response, next) {
  const traceId = uuidv4();
  request.traceId = traceId;
  response.locals.traceId = traceId;
  response.setHeader("X-Request-Id", traceId);
  response.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
  next();
}

module.exports = { requestContext };
