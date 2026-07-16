package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type affiliateIdentityRepoStub struct {
	AffiliateRepository
	invitees []AffiliateInvitee
	detail   *AffiliateInviteeDetail
}

func (r *affiliateIdentityRepoStub) ListInvitees(context.Context, int64, int, bool) ([]AffiliateInvitee, error) {
	return append([]AffiliateInvitee(nil), r.invitees...), nil
}

func (r *affiliateIdentityRepoStub) GetInviteeDetail(context.Context, int64, int64, int, bool) (*AffiliateInviteeDetail, error) {
	copy := *r.detail
	copy.RechargeRecords = append([]AffiliateInviteeRechargeRecord(nil), r.detail.RechargeRecords...)
	return &copy, nil
}

func (r *affiliateIdentityRepoStub) RecordRechargeAndPromote(context.Context, int64, float64, string, int64) ([]AffiliateAgentPromotion, error) {
	panic("unexpected RecordRechargeAndPromote call")
}

func TestAffiliateInviteeIdentityRemainsComplete(t *testing.T) {
	repo := &affiliateIdentityRepoStub{
		invitees: []AffiliateInvitee{{
			UserID:   42,
			Email:    "alice@example.com",
			Username: "alice",
		}},
		detail: &AffiliateInviteeDetail{
			UserID:   42,
			Email:    "alice@example.com",
			Username: "alice",
			RechargeRecords: []AffiliateInviteeRechargeRecord{{
				Code: "ABCD5678",
			}},
		},
	}
	service := &AffiliateService{repo: repo}

	invitees, err := service.listInvitees(context.Background(), 1, false)
	require.NoError(t, err)
	require.Equal(t, "alice@example.com", invitees[0].Email)
	require.Equal(t, "alice", invitees[0].Username)

	detail, err := service.GetInviteeDetail(context.Background(), 1, 42, 30)
	require.NoError(t, err)
	require.Equal(t, "alice@example.com", detail.Email)
	require.Equal(t, "alice", detail.Username)
	require.Equal(t, "AB***78", detail.RechargeRecords[0].Code)
}
