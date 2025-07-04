"use client";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@tabler/icons-react";
import React, { useState } from "react";
import UploadFile from "./UploadFile";
import apiClient from "@/lib/api";
import { UploadItem } from "./RecentUploads";

const SearchBar = (props: { page: string; onSearchResults: (data: UploadItem[]) => void; }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);

    if (newQuery === "") {
      props.onSearchResults([]);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (!query.trim()) {
        props.onSearchResults([]);
        return;
      }
      try {
        setLoading(true);
        const res = await apiClient.get("/search", {
          params: { userQuery: query, queryCollection: props.page },
        });
        props.onSearchResults(res.data);
        setLoading(false);
      } catch (err) {
        console.error("Search failed", err);
        setLoading(false);
      }
    }
  };

  return (
    <div className="w-full flex flex-col items-center justify-center py-4 px-4 gap-4">
      <div className="flex w-full items-center gap-4 max-w-5xl">
        <div className="relative flex-1 h-10">
          <IconSearch
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none"
            size={20}
          />
          <Input
            type="text"
            placeholder={`Search in ${props.page}`}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-4 py-2 w-full rounded-full border border-gray-300 shadow-md focus:shadow-md focus:border-gray-400 transition-all duration-200"
          />
        </div>
        <UploadFile />
      </div>
      {loading && <p>Searching...</p>}
    </div>
  );
};

export default SearchBar;