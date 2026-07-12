export type EventCategory = "tech" | "culture" | "discovery" | "world";

export type EventColor = "coral" | "sun" | "mint" | "sky" | "lilac";

export type EventItem = {
  id: string;
  title: string;
  year: number;
  category: EventCategory;
  emoji: string;
  color: EventColor;
  fact: string;
  bonusFacts?: readonly string[];
  circa?: boolean;
};
