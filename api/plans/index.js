const { plansHandler } = require("../shared/handlers");

module.exports = async function (context, req) {
  try {
    context.res = await plansHandler(req);
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "internal server error" })
    };
  }
};
