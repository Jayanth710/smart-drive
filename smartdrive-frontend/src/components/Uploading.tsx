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
  //   {
  //     text: "He makes soap",
  //   },
  //   {
  //     text: "We goto a bar",
  //   },
  //   {
  //     text: "Start a fight",
  //   },
  //   {
  //     text: "We like it",
  //   },
  //   {
  //     text: "Welcome to F**** C***",
  //   },
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

      {/* The buttons are for demo only, remove it in your actual code ⬇️ */}
      {/* <button
        onClick={() => setLoading(true)}
        className="bg-[#39C3EF] hover:bg-[#39C3EF]/90 text-black mx-auto text-sm md:text-base transition font-medium duration-200 h-10 rounded-lg px-8 flex items-center justify-center"
        style={{
          boxShadow:
            "0px -1px 0px 0px #ffffff40 inset, 0px 1px 0px 0px #ffffff40 inset",
        }}
      >
        Click to load
      </button> */}

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