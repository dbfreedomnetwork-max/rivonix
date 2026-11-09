/** Administrator access is granted exclusively by the server-managed User.role column. */
export function canReviewReports(role: string | null | undefined): boolean {
  return role === 'ADMIN';
}
