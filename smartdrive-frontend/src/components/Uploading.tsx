"use client";
import React, { Dispatch, SetStateAction } from "react";
import { MultiStepLoader as Loader } from "./ui/multi-step-loader";
import { IconSquareRoundedX } from "@tabler/icons-react";

const loadingStates = [
  {
    text: "Checking if File exists in GCS ",
  },
  {
    text: "Generating Hash for the file",
  },
  {
    text: "Uploading File to GCS ",
  },
];

type LoadingProps = {
  loadingState: [boolean, Dispatch<SetStateAction<boolean>>]
  [key: string]: unknown
}

const MultiStepLoaderDemo: React.FC<LoadingProps> = ({ loadingState }) => {
  const [loading, setLoading] = loadingState;
  return (
    <div className="w-full h-[60vh] flex items-center justify-center">
      {/* Core Loader Modal */}
      <Loader loadingStates={loadingStates} loading={loading} duration={2000} />

      {loading && (
        <button
          className="fixed top-4 right-4 text-black dark:text-white z-[120]"
          onClick={() => setLoading(false)}
        >
          <IconSquareRoundedX className="h-10 w-10" />
        </button>
      )}
    </div>
  );
}

export default MultiStepLoaderDemo;