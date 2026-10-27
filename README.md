# GRYD

# GAMES
curl -X POST "https://api.igdb.com/v4/games" \
	-H "Client-ID: 51nao0y8eswrbmauu3z3hudjwc3rhq" \
	-H "Authorization: Bearer uj9kdekck5duf31sbi43b6xqx9629x" \
	-d "fields rating; limit 1;" \
	> test.txt

# PLATFORMS
curl -X POST "https://api.igdb.com/v4/platforms" \
	-H "Client-ID: 51nao0y8eswrbmauu3z3hudjwc3rhq" \
	-H "Authorization: Bearer uj9kdekck5duf31sbi43b6xqx9629x" \
	-d "fields name; limit 500;" \
	> test.txt