package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAffiliateUserDataMasking(t *testing.T) {
	require.Equal(t, "a***@e***.com", maskEmail("alice@example.com"))
	require.Equal(t, "a***", maskUsername("alice"))
	require.Equal(t, "AB***78", maskRedeemCode("ABCD5678"))
	require.Equal(t, "****", maskRedeemCode("1234"))
}
