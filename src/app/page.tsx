import { Suspense } from "react";
import { EntryGate } from "@/components/auth/EntryGate";
import { PlaceholderSheet } from "@/components/sheet/PlaceholderSheet";
import { WorkspaceSheet } from "@/components/sheet/WorkspaceSheet";
import { getCurrentMember } from "@/server/auth";

export default async function Home() {
  const me = await getCurrentMember();

  if (me) {
    return (
      <WorkspaceSheet
        groupName={me.groupName}
        nickname={me.nickname}
        memberId={me.memberId}
      />
    );
  }

  return (
    <>
      <PlaceholderSheet />
      <Suspense fallback={null}>
        <EntryGate />
      </Suspense>
    </>
  );
}
