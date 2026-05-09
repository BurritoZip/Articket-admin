"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = { label: string; href?: string };

export function PageHeader({
  breadcrumb,
  title,
  description,
  action,
  className,
}: {
  breadcrumb: BreadcrumbItem[];
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        <nav
          aria-label="breadcrumb"
          className="text-caption text-text-tertiary"
        >
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumb.map((item, i) => (
              <li
                key={`${item.label}-${i}`}
                className="flex items-center gap-1"
              >
                {i > 0 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 opacity-60"
                    aria-hidden
                  />
                )}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="rounded-sm text-text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-text-primary" aria-current="page">
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="text-h1 text-text-primary">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-body text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
