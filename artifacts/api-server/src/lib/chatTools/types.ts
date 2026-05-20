export type ChatToolContext = {
  userId: string;
  schwabAccessToken?: string | null;
  /** Chat model id for this turn — `web_search` uses this provider's native search API. */
  activeModel: string;
};
