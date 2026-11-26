"use client";

// Предпросмотр страницы ошибки (src/app/error.tsx) на витрине: настоящую
// ошибку в приложении вызвать нечем, а экран надо проверять глазами.

import { useState } from "react";
import ErrorPage from "../../error";

export function ErrorPreview() {
  const [error] = useState(() => Object.assign(new Error("Пример ошибки для витрины"), { digest: "3141592653" }));
  return <ErrorPage error={error} unstable_retry={() => window.location.reload()} />;
}
