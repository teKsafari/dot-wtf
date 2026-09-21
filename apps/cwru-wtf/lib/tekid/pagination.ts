import 'server-only';

import { TekidManagementError, type TekidManagementClient } from './management';

const pageSize = 100;
const maximumPages = 100;
const maximumItems = pageSize * maximumPages;

// A partial role list must never be used to replace a user's complete assignments.
export async function listAllManagementItems<T extends { id: string }>(
  management: TekidManagementClient,
  path: string,
  parsePage: (data: unknown) => T[],
  query: Record<string, string> = {}
): Promise<T[]> {
  const items: T[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  let hasTotalHeader: boolean | undefined;

  for (let page = 1; page <= maximumPages; page += 1) {
    let response;
    try {
      response = await management.request('GET', path, {
        query: { ...query, page: String(page), page_size: String(pageSize) },
      });
    } catch (error) {
      // Only a first-page 404/422 can establish that a membership is absent.
      if (page > 1) throw new TekidManagementError(503);
      throw error;
    }

    const pageItems = parsePage(response.data);
    const totalHeader = response.headers.get('total-number');
    const totalIsPresent = totalHeader !== null;
    if (hasTotalHeader !== undefined && hasTotalHeader !== totalIsPresent) {
      throw new TekidManagementError(503);
    }
    hasTotalHeader = totalIsPresent;
    if (totalIsPresent) {
      if (!/^(0|[1-9]\d*)$/.test(totalHeader)) throw new TekidManagementError(503);
      const total = Number(totalHeader);
      if (!Number.isSafeInteger(total) || total > maximumItems ||
          (expectedTotal !== undefined && expectedTotal !== total)) {
        throw new TekidManagementError(503);
      }
      expectedTotal = total;
    }

    if (pageItems.length > pageSize) throw new TekidManagementError(503);
    for (const item of pageItems) {
      if (ids.has(item.id)) throw new TekidManagementError(503);
      ids.add(item.id);
      items.push(item);
    }

    if (expectedTotal !== undefined) {
      if (items.length > expectedTotal) throw new TekidManagementError(503);
      if (items.length === expectedTotal) return items;
      if (pageItems.length < pageSize) throw new TekidManagementError(503);
    } else if (pageItems.length < pageSize) {
      return items;
    }
  }

  throw new TekidManagementError(503);
}
