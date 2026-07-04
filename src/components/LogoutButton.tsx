"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // The server component re-reads the now-cleared session cookie.
    router.refresh();
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="font-outfit"
      onClick={handleLogout}
      disabled={loggingOut}
    >
      Log out
    </Button>
  );
}
