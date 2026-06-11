module.exports = (req, res) => {
  res.status(200).json({ ok: true, runtime: 'cjs', node: process.version });
};
