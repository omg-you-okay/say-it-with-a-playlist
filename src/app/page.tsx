import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="max-w-md rounded-md border border-red-700/30 bg-sidebar-accent px-6 py-5 drop-shadow-2xl drop-shadow-gray-300">
        <h1 className="mb-2 font-blackletter text-4xl tracking-tight text-red-700">
          Say It With a Playlist
        </h1>

        <p className="text-md mb-12 text-left font-outfit font-light">
          Type a sentence and get a real Spotify playlist whose track titles —
          read in order — spell it out.
        </p>

        <Button size="sm" variant="default" className="font-outfit">
          Log in with Spotify{" "}
          <span className="text-xs text-white/70">(coming soon)</span>
        </Button>
      </div>
    </main>
  );
}
