import { randomUUID } from 'node:crypto';
import { getRequestId } from '@customer-ops/logger';

export interface BusinessResponse<Data> {
  data: Data;
  meta: { request_id: string };
}

export function businessResponse<Data>(data: Data): BusinessResponse<Data> {
  return { data, meta: { request_id: getRequestId() ?? randomUUID() } };
}
