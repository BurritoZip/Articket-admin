"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";

interface PopularArtist {
  artistId: string;
  name: string;
  avatarUrl: string | null;
  label: string | null;
  followersCount: number | null;
  popularityScore: number | null;
  trendingScore: number | null;
  rank: number;
}
interface RecommendedArtist {
  artistId: string;
  name: string;
  avatarUrl: string | null;
  label: string | null;
  popularityScore: number | null;
  score: number;
  breakdown: { coPerformer: number; agency: number; genre: number };
  reasons: string[];
}
interface PreviewResponse {
  weights: { coPerformer: number; agency: number; genre: number };
  popular: PopularArtist[];
  forYou: RecommendedArtist[];
  forYouColdStart: boolean;
  previewUserId: string | null;
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString());

export function RecommendationsPageClient() {
  const [userInput, setUserInput] = React.useState("");
  const [userId, setUserId] = React.useState("");

  const { data, isLoading, isError } = useQuery<PreviewResponse>({
    queryKey: ["admin-artist-recs", userId],
    queryFn: async () => {
      const url = userId
        ? `/api/admin/recommendations/artists?userId=${encodeURIComponent(userId)}`
        : "/api/admin/recommendations/artists";
      const res = await fetch(url);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-8">
      {/* 좋아할만한 아티스트 (개인화) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-h3">당신이 좋아할만한 아티스트</h2>
            <p className="text-sm text-muted-foreground">
              유저가 팔로우한 아티스트 기준 · 같은 무대(
              {Math.round((data?.weights.coPerformer ?? 0.4) * 100)}%) · 같은 소속사(
              {Math.round((data?.weights.agency ?? 0.3) * 100)}%) · 비슷한 장르(
              {Math.round((data?.weights.genre ?? 0.3) * 100)}%)
            </p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setUserId(userInput.trim());
            }}
          >
            <Input
              placeholder="미리볼 유저 UUID"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              className="w-[320px]"
            />
            <Button type="submit">미리보기</Button>
          </form>
        </div>

        {!userId ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            유저 UUID를 입력하면 해당 유저의 개인화 추천을 미리볼 수 있습니다.
          </p>
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : data?.forYouColdStart ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            이 유저는 팔로우한 아티스트가 없어 콜드스타트 상태입니다. (앱에서는
            인기 아티스트로 폴백)
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>아티스트</TableHead>
                <TableHead>소속사</TableHead>
                <TableHead className="text-right">점수</TableHead>
                <TableHead className="text-right">무대/소속사/장르</TableHead>
                <TableHead>추천 이유</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.forYou ?? []).map((a) => (
                <TableRow key={a.artistId}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.label ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.score.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {a.breakdown.coPerformer.toFixed(2)} /{" "}
                    {a.breakdown.agency.toFixed(2)} / {a.breakdown.genre.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.reasons.join(" · ")}
                  </TableCell>
                </TableRow>
              ))}
              {(data?.forYou ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    추천 결과가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </section>

      {/* 인기 아티스트 */}
      <section className="space-y-3">
        <div>
          <h2 className="text-h3">인기 아티스트</h2>
          <p className="text-sm text-muted-foreground">
            popularity_score 기준 (팔로우 + 공연 좋아요/리뷰 등 내부 신호)
          </p>
        </div>
        {isLoading ? (
          <Skeleton className="h-60 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">불러오기 실패</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>아티스트</TableHead>
                <TableHead>소속사</TableHead>
                <TableHead className="text-right">팔로워</TableHead>
                <TableHead className="text-right">인기점수</TableHead>
                <TableHead className="text-right">트렌드</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.popular ?? []).map((a) => (
                <TableRow key={a.artistId}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {a.rank}
                  </TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.label ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(a.followersCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.popularityScore?.toFixed(1) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {a.trendingScore?.toFixed(0) ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
