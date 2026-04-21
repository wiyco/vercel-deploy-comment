export function buildDeploymentRowKey(
  projectId: string,
  environment: string,
): string {
  return `${projectId}\u0000${environment}`;
}
