import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Say It With a Playlist
      </h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Type a sentence and get a real Spotify playlist whose track titles —
        read in order — spell it out.
      </p>
      <Button size="lg" disabled>
        Log in with Spotify — coming soon
      </Button>
    </main>
  );
}
