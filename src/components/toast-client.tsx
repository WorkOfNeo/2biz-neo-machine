"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function ToastClient() {
  return (
    <ToastContainer position="bottom-right" newestOnTop hideProgressBar closeOnClick pauseOnHover={false} />
  );
}


