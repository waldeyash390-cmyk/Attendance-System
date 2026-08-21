const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (!SECRET) {
  console.warn('[auth] JWT_SECRET is not set; tokens will be rejected until it is configured.');
}

function signToken(payload) {
  if (!SECRET) throw new Error('JWT_SECRET not configured');
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET not configured');
  return jwt.verify(token, SECRET);
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  if (scheme && scheme.toLowerCase() === 'bearer' && value) return value.trim();
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const decoded = verifyToken(token);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      email: decoded.email,
    };
    return next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 401 : 401;
    return res.status(code).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...allowed) {
  const allowedSet = new Set(allowed);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!allowedSet.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', required: Array.from(allowedSet) });
    }
    return next();
  };
}

module.exports = { signToken, verifyToken, requireAuth, requireRole };
