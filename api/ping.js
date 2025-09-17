const config = { runtime: "nodejs20.x" };

module.exports = async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    node: process.version,
    ts: new Date().toISOString(),
  });
};

module.exports.config = config;
