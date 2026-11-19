export const APP_NAME = "{{projectName}}";
export const APP_PURPOSE = "{{projectPurpose}}";

export function App() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>{APP_PURPOSE}</p>
    </main>
  );
}
