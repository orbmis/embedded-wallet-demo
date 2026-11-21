"use client";
import { useState } from "react";

export interface LogEntry {
  ts: number;
  msg: string;
}

interface Props {
  entries: LogEntry[];
}

export default function ActivityLog({ entries }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden text-xs font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-100"
      >
        <span>Activity log ({entries.length})</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto p-3 space-y-1 bg-gray-900 text-green-300">
          {entries.length === 0 && (
            <div className="text-gray-500">No events yet.</div>
          )}
          {entries.map((e, i) => (
            <div key={i}>
              <span className="text-gray-500">
                {new Date(e.ts).toLocaleTimeString()}
              </span>{" "}
              {e.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
