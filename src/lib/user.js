import { join } from 'path';

export function getUser() {
  return {
    id: process.env.THINKDONE_USER || 'default',
    name: process.env.THINKDONE_USER_NAME || 'User',
    workspace: process.env.THINKDONE_WORKSPACE || join(process.cwd(), '..'),
  };
}
