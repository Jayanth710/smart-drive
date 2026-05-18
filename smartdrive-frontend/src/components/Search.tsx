"use client";
import { Input } from "@/components/ui/input";
import { IconSearch, IconX } from "@tabler/icons-react";
import React, { useState } from "react";
import apiClient from "@/lib/api";
import { UploadItem } from "./FileListWithDrawer";

type SearchBarProps = {
  page: string;
  onSearchResults: (data: UploadItem[]) => void;
  /** Called whenever the active query changes (empty string when cleared). */
  onQueryChange?: (query: string) => void;
};

const SearchBar = ({ page, onSearchResults, onQueryChange }: SearchBarProps) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    if (newQuery === "") {
      onSearchResults([]);
      onQueryChange?.("");
    }
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      onSearchResults([]);
      onQueryChange?.("");
      return;
    }
    try {
      setLoading(true);
      const res = await apiClient.get("/search", {
        params: { userQuery: q, queryCollection: page },
      });
      onSearchResults(res.data);
      onQueryChange?.(q);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setQuery("");
    onSearchResults([]);
    onQueryChange?.("");
  };

  return (
    <div className="w-full">
      <div className="relative h-10">
        <IconSearch
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          size={18}
        />
        <Input
          type="text"
          placeholder={`Search in ${page}…`}
          value={query}
          onChange={handleQueryChange}
          onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
          className="pl-10 pr-9 py-2 w-full rounded-full border shadow-sm focus:shadow-md transition-shadow"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <IconX size={16} />
          </button>
        )}
      </div>
      {loading && <p className="text-xs text-muted-foreground mt-1 px-3">Searching…</p>}
    </div>
  );
};

export default SearchBar;
