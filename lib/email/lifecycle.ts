export type LifecycleEmailKind = never;

export type DispatchLifecycleEmailsOptions = {
  kinds?: LifecycleEmailKind[];
  userId?: string | null;
  now?: Date;
};

export type DispatchLifecycleEmailsResult = {
  ok: true;
};

export async function dispatchLifecycleEmails(
  _options: DispatchLifecycleEmailsOptions = {}
): Promise<DispatchLifecycleEmailsResult> {
  return { ok: true };
}
