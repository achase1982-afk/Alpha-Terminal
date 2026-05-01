let pendingJobId: string | null = null;

export function setPendingStrategistPushJobId(jobId: string | null): void {
  pendingJobId = jobId && jobId.length > 0 ? jobId : null;
}

export function consumePendingStrategistPushJobId(): string | null {
  const id = pendingJobId;
  pendingJobId = null;
  return id;
}
