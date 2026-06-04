"use client";

// 수박게임(버블 합치기) — 개인전 전용.
// 같은 숫자 버블이 닿으면 합쳐져 다음 단계가 되고, 넘치면 게임 오버.
// 위장: 회색·파스텔 원 + 숫자 라벨 + 가짜 축/눈금으로 시트의 버블 차트처럼 보이게 그린다.
// 물리는 matter-js로 클라이언트에서 돌리고, 서버에는 점수 기록만 남긴다.

import { useCallback, useEffect, useRef, useState } from "react";
import Matter from "matter-js";

const W = 420;
const H = 540;
const WALL = 12; // 벽 두께(화면 밖)
const DROP_Y = 48; // 드롭 높이
const LIMIT_Y = 92; // 게임 오버 한계선
const DROP_COOLDOWN_MS = 550;
const OVER_HOLD_MS = 1500; // 한계선 위에 이만큼 머물면 게임 오버
const MAX_TIER = 10; // 0~10, 11단계

// 단계별 반지름 — 구글시트 차트 파스텔 팔레트로 위장
const TIER_RADIUS = [14, 20, 27, 34, 42, 51, 61, 72, 84, 97, 111];
const TIER_COLOR = [
  "#cfe2f3", "#d9ead3", "#fff2cc", "#f4cccc", "#d9d2e9",
  "#c9daf8", "#d0e0e3", "#ead1dc", "#b6d7a8", "#ffe599", "#9fc5e8",
];
const TIER_LABEL = TIER_RADIUS.map((_, i) => String(2 ** (i + 1)));
// 합칠 때 점수: 작은 합성도 의미 있게, 큰 합성일수록 크게
const MERGE_POINTS = TIER_RADIUS.map((_, i) => ((i + 1) * (i + 2)) / 2);
const SPAWN_TIERS = 5; // 0~4 단계만 떨어진다(원작 방식)

type GamePhase = "ready" | "playing" | "over";

function tierOf(body: Matter.Body): number | null {
  if (!body.label.startsWith("bubble:")) return null;
  return Number(body.label.slice("bubble:".length));
}

function makeBubble(x: number, y: number, tier: number): Matter.Body {
  return Matter.Bodies.circle(x, y, TIER_RADIUS[tier], {
    label: `bubble:${tier}`,
    restitution: 0.15,
    friction: 0.1,
    density: 0.0015,
  });
}

export function SuikaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [nextTier, setNextTier] = useState(0); // 미리보기 표시용(로직은 ref)

  const engineRef = useRef<Matter.Engine | null>(null);
  const rafRef = useRef<number>(0);
  const aimXRef = useRef(W / 2);
  const currentTierRef = useRef(0); // 지금 떨어뜨릴 버블
  const nextTierRef = useRef(0); // 다음 버블(미리보기)
  const lastDropAtRef = useRef(0);
  const overSinceRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const phaseRef = useRef<GamePhase>("ready");
  const mergingRef = useRef<Set<number>>(new Set()); // 같은 프레임 중복 합성 방지

  // 점수 기록 — 게임 오버/그만하기 시 호출. 솔로 기록(참가자 1명)으로 저장된다.
  const recordScore = useCallback(async (finalScore: number) => {
    if (finalScore <= 0) return;
    setSaving(true);
    try {
      await fetch("/api/suika/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: finalScore }),
      });
      setBest((prev) => (prev == null || finalScore > prev ? finalScore : prev));
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }, []);

  const rollTier = useCallback(() => {
    return Math.floor(Math.random() * SPAWN_TIERS);
  }, []);

  // 새 판 세팅 — 엔진/상태 초기화
  const resetGame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    Matter.Composite.clear(engine.world, false);
    // 벽(좌/우/바닥)은 화면 밖에 두께만 걸치게 배치
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(-WALL / 2, H / 2, WALL, H * 2, { isStatic: true }),
      Matter.Bodies.rectangle(W + WALL / 2, H / 2, WALL, H * 2, { isStatic: true }),
      Matter.Bodies.rectangle(W / 2, H + WALL / 2, W + WALL * 2, WALL, { isStatic: true }),
    ]);
    mergingRef.current.clear();
    overSinceRef.current = null;
    lastDropAtRef.current = 0;
    currentTierRef.current = Math.floor(Math.random() * SPAWN_TIERS);
    nextTierRef.current = Math.floor(Math.random() * SPAWN_TIERS);
    setNextTier(nextTierRef.current);
    scoreRef.current = 0;
    setScore(0);
    setPhase("playing");
  }, []);

  // 엔진 생성 + 충돌(합성) 핸들러 + 렌더 루프
  useEffect(() => {
    const engine = Matter.Engine.create();
    engine.gravity.y = 1;
    engineRef.current = engine;

    const onCollision = (e: Matter.IEventCollision<Matter.Engine>) => {
      for (const pair of e.pairs) {
        const { bodyA, bodyB } = pair;
        const tierA = tierOf(bodyA);
        const tierB = tierOf(bodyB);
        if (tierA == null || tierA !== tierB) continue;
        if (tierA >= MAX_TIER) continue; // 최고 단계는 합치지 않는다
        if (mergingRef.current.has(bodyA.id) || mergingRef.current.has(bodyB.id)) {
          continue;
        }
        mergingRef.current.add(bodyA.id);
        mergingRef.current.add(bodyB.id);
        const mx = (bodyA.position.x + bodyB.position.x) / 2;
        const my = (bodyA.position.y + bodyB.position.y) / 2;
        Matter.Composite.remove(engine.world, bodyA);
        Matter.Composite.remove(engine.world, bodyB);
        Matter.Composite.add(engine.world, makeBubble(mx, my, tierA + 1));
        scoreRef.current += MERGE_POINTS[tierA];
        setScore(scoreRef.current);
      }
    };
    Matter.Events.on(engine, "collisionStart", onCollision);

    let lastTime = performance.now();
    const loop = (time: number) => {
      const dt = Math.min(32, time - lastTime);
      lastTime = time;
      if (phaseRef.current === "playing") {
        Matter.Engine.update(engine, dt);
        mergingRef.current.clear();
        checkGameOver(time);
      }
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };

    // 한계선 위에 버블이 일정 시간 머물면 게임 오버
    const checkGameOver = (time: number) => {
      // 드롭 직후 통과 중인 버블은 제외(잠깐의 통과는 봐준다)
      if (time - lastDropAtRef.current < 700) {
        overSinceRef.current = null;
        return;
      }
      let overflowing = false;
      for (const body of Matter.Composite.allBodies(engine.world)) {
        const tier = tierOf(body);
        if (tier == null) continue;
        if (body.position.y - TIER_RADIUS[tier] < LIMIT_Y && Math.abs(body.velocity.y) < 0.3) {
          overflowing = true;
          break;
        }
      }
      if (!overflowing) {
        overSinceRef.current = null;
        return;
      }
      if (overSinceRef.current == null) {
        overSinceRef.current = time;
      } else if (time - overSinceRef.current >= OVER_HOLD_MS) {
        phaseRef.current = "over";
        setPhase("over");
        void recordScore(scoreRef.current);
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, W, H);

      // 가짜 차트 배경 — 옅은 격자 + 좌측 눈금 숫자 (시트 차트 위장)
      ctx.strokeStyle = "#eceff1";
      ctx.fillStyle = "#9aa0a6";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.lineWidth = 1;
      for (let y = H - 60; y > 40; y -= 60) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(W, y + 0.5);
        ctx.stroke();
        ctx.fillText(String(Math.round((H - y) / 6) * 10), W - 4, y - 3);
      }

      // 게임 오버 한계선 — 빨간 점선 대신 차트 기준선처럼 옅게
      ctx.strokeStyle = "#e8a8a8";
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, LIMIT_Y + 0.5);
      ctx.lineTo(W, LIMIT_Y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // 조준 가이드 + 떨어뜨릴 버블 미리보기
      if (phaseRef.current === "playing") {
        const tier = currentTierRef.current;
        const r = TIER_RADIUS[tier];
        const x = Math.max(r + 2, Math.min(W - r - 2, aimXRef.current));
        ctx.strokeStyle = "#dadce0";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, DROP_Y);
        ctx.lineTo(x + 0.5, H);
        ctx.stroke();
        ctx.setLineDash([]);
        drawBubble(ctx, x, DROP_Y, tier, 0.85);
      }

      // 버블들
      for (const body of Matter.Composite.allBodies(engineRef.current!.world)) {
        const tier = tierOf(body);
        if (tier == null) continue;
        drawBubble(ctx, body.position.x, body.position.y, tier, 1);
      }
    };

    const drawBubble = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      tier: number,
      alpha: number,
    ) => {
      const r = TIER_RADIUS[tier];
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = TIER_COLOR[tier];
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#5f6368";
      ctx.font = `${Math.max(10, Math.min(22, r * 0.6))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(TIER_LABEL[tier], x, y + 1);
      ctx.globalAlpha = 1;
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      Matter.Events.off(engine, "collisionStart", onCollision);
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
    };
  }, [recordScore]);

  // phase를 ref와 동기화(렌더 루프에서 참조)
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    aimXRef.current = ((e.clientX - rect.left) / rect.width) * W;
  }, []);

  const drop = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const engine = engineRef.current;
    if (!engine) return;
    const nowMs = performance.now();
    if (nowMs - lastDropAtRef.current < DROP_COOLDOWN_MS) return;
    lastDropAtRef.current = nowMs;
    const tier = currentTierRef.current;
    const r = TIER_RADIUS[tier];
    const x = Math.max(r + 2, Math.min(W - r - 2, aimXRef.current));
    Matter.Composite.add(engine.world, makeBubble(x, DROP_Y, tier));
    currentTierRef.current = nextTierRef.current;
    nextTierRef.current = rollTier();
    setNextTier(nextTierRef.current);
  }, [rollTier]);

  // 그만하기 — 현재 점수 기록 후 대기 화면으로
  const quitAndRecord = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    phaseRef.current = "ready";
    setPhase("ready");
    void recordScore(scoreRef.current);
  }, [recordScore]);

  return (
    <div className="flex flex-col items-center gap-3 w-full pt-4 pb-8">
      {/* 점수 헤더 — 다른 게임과 같은 시트 셀 스타일 */}
      <div className="flex items-stretch border border-[var(--sheet-cell-border)] bg-white w-full max-w-[600px]">
        <div className="flex flex-col items-center min-w-[100px] px-3 py-2 border-r border-[var(--sheet-cell-border)]">
          <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
            점수
          </span>
          <span className="text-[20px] tabular-nums">{score}</span>
        </div>
        <div className="flex flex-col items-center min-w-[100px] px-3 py-2 border-r border-[var(--sheet-cell-border)]">
          <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
            이번 세션 최고
          </span>
          <span className="text-[20px] tabular-nums">{best ?? "—"}</span>
        </div>
        <div className="flex-1 flex items-center justify-end gap-2 px-3">
          {phase === "playing" && (
            <>
              {/* 다음 버블 미리보기 */}
              <span className="text-[11px] text-[var(--sheet-muted)]">다음</span>
              <span
                className="inline-block w-5 h-5 rounded-full border border-white"
                style={{ backgroundColor: TIER_COLOR[nextTier] }}
              />
              <button
                type="button"
                onClick={quitAndRecord}
                disabled={saving}
                className="ml-2 px-3 py-1 rounded border border-[var(--sheet-cell-border)] text-[12px] text-[var(--sheet-muted)] hover:bg-black/5 disabled:opacity-50"
              >
                그만하기 (점수 기록)
              </button>
            </>
          )}
        </div>
      </div>

      {/* 차트 위장 캔버스 */}
      <div className="relative border border-[var(--sheet-cell-border)] bg-white">
        <div className="px-3 pt-2 text-[12px] text-[var(--sheet-muted)]">
          분기별 지표 분포
        </div>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerMove={onPointerMove}
          onPointerDown={drop}
          className="block cursor-crosshair touch-none select-none"
        />
        {phase !== "playing" && (
          <div className="absolute inset-0 grid place-items-center bg-white/85">
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              {phase === "over" ? (
                <>
                  <div className="text-[16px] font-medium text-[var(--sheet-fg)]">
                    게임 오버
                  </div>
                  <div className="text-[13px] text-[var(--sheet-muted)]">
                    점수 {score}점{saving ? " · 기록 중..." : " · 기록 완료"}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[16px] font-medium text-[var(--sheet-fg)]">
                    수박게임
                  </div>
                  <p className="text-[13px] text-[var(--sheet-muted)] whitespace-pre-line">
                    {"마우스로 위치를 정하고 클릭해서 버블을 떨어뜨리세요.\n같은 숫자끼리 닿으면 합쳐져요. 점선 위로 넘치면 종료!"}
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={resetGame}
                className="px-5 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[15px] font-medium hover:brightness-95"
              >
                {phase === "over" ? "다시 시작" : "시작"}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="text-[11px] text-[var(--sheet-muted)]">
        개인전 게임이에요 — 점수는 점수판의 혼자 기록으로 올라가요. Ctrl+B로 즉시 시트 홈으로 이동
      </div>
    </div>
  );
}
