import type { Metadata } from "next";
import Game from "./Game";

export const metadata: Metadata = {
  title: "WHEN? — The daily timeline game",
  description:
    "Place surprising events in order and discover which completely unrelated things happened at the same time.",
};

export default function Home() {
  return <Game />;
}
