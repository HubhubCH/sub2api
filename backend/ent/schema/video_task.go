package schema

import (
	"github.com/Wei-Shaw/sub2api/ent/schema/mixins"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// VideoTask 保存异步视频请求不可变的所有权和原上游账号绑定。
type VideoTask struct {
	ent.Schema
}

func (VideoTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "video_tasks"},
	}
}

func (VideoTask) Mixin() []ent.Mixin {
	return []ent.Mixin{
		mixins.TimeMixin{},
	}
}

func (VideoTask) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider").MaxLen(32).Immutable(),
		field.String("upstream_task_id").MaxLen(255).Immutable(),
		field.Int64("account_id").Immutable(),
		field.Int64("group_id").Immutable(),
		field.Int64("user_id").Immutable(),
		field.Int64("api_key_id").Immutable(),
		field.String("model").MaxLen(128).Immutable(),
		field.String("status").MaxLen(32).Default("submitted"),
		field.Time("expires_at").Immutable().SchemaType(map[string]string{
			dialect.Postgres: "timestamptz",
		}),
	}
}

func (VideoTask) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("provider", "account_id", "upstream_task_id").Unique(),
		index.Fields("user_id", "api_key_id", "provider", "upstream_task_id"),
		index.Fields("expires_at"),
		index.Fields("account_id"),
	}
}
