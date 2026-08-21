import { api, extractError } from './client';

export async function listUsers(params = {}) {
  const cleaned = {};
  if (params.role) cleaned.role = params.role;
  if (params.q) cleaned.q = params.q;
  if (params.department) cleaned.department = params.department;
  if (params.activeOnly === true) cleaned.activeOnly = 'true';
  const { data } = await api.get('/users', { params: cleaned });
  return data.users || [];
}
