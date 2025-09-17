export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    node: process.version,
    ts: new Date().toISOString(),
    message: 'Ping endpoint working!'
  });
}