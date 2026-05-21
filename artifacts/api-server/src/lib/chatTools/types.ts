export type ChatToolContext = {
  userId: string;
  schwabAccessToken?: string | null;
  /** Chat model id for this turn — `web_search` uses TAVILY_API_KEY / SERPER_API_KEY when set, else provider-native search. */
  activeModel: string;
};
