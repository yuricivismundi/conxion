"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="material-symbols-outlined text-[48px] text-slate-500">error</span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">Something went wrong</p>
            <p className="text-sm text-slate-400">Please refresh the page. If this keeps happening, contact support.</p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15"
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
