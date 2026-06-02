import { Suspense } from "react";
import { EntryGate } from "@/components/auth/EntryGate";
import { PlaceholderSheet } from "@/components/sheet/PlaceholderSheet";
import { WorkspaceSheet } from "@/components/sheet/WorkspaceSheet";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

export default async function Home() {
  const me = await getCurrentMember();

  if (me) {
    const isOwner = await isGroupOwner(me.groupId, me.memberId);
    return (
      <WorkspaceSheet
        groupName={me.groupName}
        nickname={me.nickname}
        memberId={me.memberId}
        isOwner={isOwner}
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
