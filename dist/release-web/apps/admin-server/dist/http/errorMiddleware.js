export function errorMiddleware() {
    return (err, _req, res) => {
        const status = typeof err?.status === "number" ? err.status : 500;
        const code = typeof err?.code === "string" ? err.code : "INTERNAL_ERROR";
        const message = typeof err?.message === "string" ? err.message : "Internal Error";
        if (status >= 500) {
            res.status(500).json({ error: "INTERNAL_ERROR" });
            return;
        }
        res.status(status).json({ error: code, message });
    };
}
