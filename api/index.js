// Simple health-check root route: GET /
module.exports = (req, res) => {
    res.status(200).json({
        status: "ok",
        endpoint: "/api/tiktok/search?text=<query>",
    });
};
