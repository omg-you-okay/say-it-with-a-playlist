import { Button, buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="max-w-md bg-sidebar-accent px-6 py-5 rounded-md drop-shadow-gray-300 drop-shadow-2xl border-red-700/30 border">
        <h1 className="text-4xl text-red-700 font-blackletter tracking-tight mb-2">
          Say It With a Playlist
        </h1>

        <p className="text-md font-outfit text-left mb-12 font-light">
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
