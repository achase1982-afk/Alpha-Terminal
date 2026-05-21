export type ChatToolContext = {
  userId: string;
  schwabAccessToken?: string | null;
  /** Chat model id for this turn — `web_search` uses WEB_SEARCH_API_* when set, else provider-native search. */
  activeModel: string;
};
